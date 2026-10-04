-- Esquema base del pipeline de datos. Idempotente: se puede correr varias veces.

-- Un registro por juego (temporada regular y postemporada).
CREATE TABLE IF NOT EXISTS games (
  game_pk          integer     PRIMARY KEY,
  season           smallint    NOT NULL,
  game_date        date        NOT NULL,  -- officialDate de MLB
  game_type        char(1)     NOT NULL,  -- R, F, D, L, W
  abstract_state   text        NOT NULL,  -- Preview | Live | Final
  status           text        NOT NULL,  -- detailedState (Final, Postponed, Completed Early...)
  away_team_id     integer     NOT NULL,
  home_team_id     integer     NOT NULL,
  venue_id         integer,
  pbp_ingested_at  timestamptz,           -- null = play-by-play pendiente
  pbp_error        text,                  -- último error de ingesta, si hubo
  pa_count         integer,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS games_season_date_idx ON games (season, game_date);

-- Una fila por jugada del play-by-play (allPlays). is_pa distingue los turnos
-- completos de las jugadas que cierran entrada sin terminar el turno (ej. CS).
CREATE TABLE IF NOT EXISTS plays (
  game_pk        integer  NOT NULL REFERENCES games ON DELETE CASCADE,
  at_bat_index   smallint NOT NULL,
  game_date      date     NOT NULL,  -- copia de games.game_date para filtrar ventanas sin join
  inning         smallint NOT NULL,
  half           char(1)  NOT NULL,  -- t | b
  batter_id      integer,
  pitcher_id     integer,
  bat_side       char(1),            -- mano con la que bateó en este turno
  pitch_hand     char(1),
  event          text     NOT NULL,
  event_type     text,
  is_pa          boolean  NOT NULL,
  pre_outs       smallint NOT NULL,
  on_1b          boolean  NOT NULL,
  on_2b          boolean  NOT NULL,
  on_3b          boolean  NOT NULL,
  runs_scored    smallint NOT NULL,
  outs_recorded  smallint NOT NULL,
  rbi            smallint NOT NULL,
  PRIMARY KEY (game_pk, at_bat_index)
);
-- Batted-ball type of the play (fly_ball, popup, line_drive, ground_ball; null
-- without contact). Used for xFIP's fly balls, which events alone can't give
-- (a fly ball that falls for a hit is just "Single"/"Double").
ALTER TABLE plays ADD COLUMN IF NOT EXISTS trajectory text;
CREATE INDEX IF NOT EXISTS plays_batter_date_idx  ON plays (batter_id, game_date);
CREATE INDEX IF NOT EXISTS plays_pitcher_date_idx ON plays (pitcher_id, game_date);

-- Factores de parque por equipo local, temporada y fuente, en escala ×100 como
-- los publica FanGraphs (100 = neutral). basic_5yr es el que FanGraphs usa en wRC+.
CREATE TABLE IF NOT EXISTS park_factors (
  season      smallint NOT NULL,
  team_id     integer  NOT NULL,
  source      text     NOT NULL,
  basic_5yr   smallint NOT NULL,
  three_yr    smallint,
  one_yr      smallint,
  f_1b        smallint,
  f_2b        smallint,
  f_3b        smallint,
  f_hr        smallint,
  f_so        smallint,
  f_bb        smallint,
  f_gb        smallint,
  f_fb        smallint,
  f_ld        smallint,
  f_iffb      smallint,
  f_fip       smallint,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, team_id, source)
);

-- Constantes de liga por temporada y fuente (re24, fangraphs...).
CREATE TABLE IF NOT EXISTS league_constants (
  season       smallint    NOT NULL,
  source       text        NOT NULL,
  constants    jsonb       NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, source)
);

-- ── Seguridad de la API de Supabase ─────────────────────────────────────────
-- Supabase expone el esquema public por su API REST con la llave publicable,
-- que va dentro de la app. RLS sin políticas = nadie puede leer ni escribir por
-- esa vía; el backend se conecta como el rol postgres, que no pasa por RLS.
ALTER TABLE games            ENABLE ROW LEVEL SECURITY;
ALTER TABLE plays            ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_constants ENABLE ROW LEVEL SECURITY;
ALTER TABLE park_factors     ENABLE ROW LEVEL SECURITY;

-- ── Perfiles de usuario ─────────────────────────────────────────────────────
-- Una fila por cuenta de Supabase Auth, creada por el trigger de abajo. El
-- nombre de usuario se elige después (con Google/Apple no viene), por eso
-- puede ser null hasta que el usuario completa su perfil.
CREATE TABLE IF NOT EXISTS profiles (
  id                uuid        PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  username          text,
  favorite_team_id  integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_username_format CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,20}$')
);
-- Único sin distinguir mayúsculas: "Diego" y "diego" no pueden coexistir.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key ON profiles (lower(username));

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
-- Los nombres de usuario son públicos (ranking, votos).
DROP POLICY IF EXISTS profiles_select_all ON profiles;
CREATE POLICY profiles_select_all ON profiles FOR SELECT USING (true);
-- Cada quien edita solo su fila, y solo estas dos columnas.
DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
REVOKE INSERT, UPDATE, DELETE ON profiles FROM anon, authenticated;
GRANT UPDATE (username, favorite_team_id) ON profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_touch_updated_at ON profiles;
CREATE TRIGGER profiles_touch_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Equipos y estadios ──────────────────────────────────────────────────────
-- Estadios: nombre y tipo de techo (fieldInfo.roofType de MLB: Open,
-- Retractable, Dome). Los park factors viven en park_factors (FanGraphs).
CREATE TABLE IF NOT EXISTS venues (
  venue_id    integer     PRIMARY KEY,
  name        text        NOT NULL,
  roof_type   text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Equipos de MLB y de la LMB con su identidad visual. team_key = id de MLB
-- ('135') o código corto de la LMB ('MTY').
CREATE TABLE IF NOT EXISTS teams (
  league            text        NOT NULL CHECK (league IN ('MLB', 'LMB')),
  team_key          text        NOT NULL,
  abbr              text,
  city              text,
  nickname          text,
  color             text        NOT NULL CHECK (color  ~ '^#[0-9A-Fa-f]{6}$'),
  color2            text        NOT NULL CHECK (color2 ~ '^#[0-9A-Fa-f]{6}$'),
  bar_color         text                 CHECK (bar_color ~ '^#[0-9A-Fa-f]{6}$'),
  cap_logo_variant  text        NOT NULL DEFAULT 'dark' CHECK (cap_logo_variant IN ('dark', 'light')),
  mlb_league_id     integer,             -- 103 AL, 104 NL
  division_id       integer,
  venue_id          integer     REFERENCES venues,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league, team_key)
);

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams  ENABLE ROW LEVEL SECURITY;
