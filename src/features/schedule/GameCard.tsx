import type React from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import type { ScheduledGame } from "@/api/mlb/types";
import { getTeamMeta, getBarColor, capLogoUrl, teamBg } from "@/data/teams";
import MatchupBar from "@/components/MatchupBar/MatchupBar";
import styles from "./GameCard.module.css";

export type LineupStatus = 'confirmed' | 'projected'

interface Props {
  game: ScheduledGame;
  awayOpsPlus?: number;
  homeOpsPlus?: number;
  awayFipPlus?: number;
  homeFipPlus?: number;
  awayPitchHand?: string;
  homePitchHand?: string;
  awayLineupStatus?: LineupStatus;
  homeLineupStatus?: LineupStatus;
  animDelay?: number;
}

export default function GameCard({
  game,
  awayOpsPlus,
  homeOpsPlus,
  awayFipPlus,
  homeFipPlus,
  awayPitchHand,
  homePitchHand,
  awayLineupStatus,
  homeLineupStatus,
  animDelay = 0,
}: Props) {
  const { teams, gamePk, gameDate, venue } = game;
  const am = getTeamMeta(teams.away.team.id);
  const hm = getTeamMeta(teams.home.team.id);

  const ac = am?.color ?? "#555";
  const hc = hm?.color ?? "#555";
  const acBar = am ? getBarColor(am) : ac;
  const hcBar = hm ? getBarColor(hm) : hc;
  const time = format(parseISO(gameDate), "h:mm a");

  const awayPitcher = (game as GameWithPitcher).teams?.away?.probablePitcher;
  const homePitcher = (game as GameWithPitcher).teams?.home?.probablePitcher;

  return (
    <Link
      to={`/game/${gamePk}`}
      className={`${styles.card} fade-up`}
      style={{ animationDelay: `${animDelay}ms` }}
    >
      <div className={styles.hoverBg} style={{ background: teamBg(ac, hc) }} />

      <div className={styles.header}>
        <span className={styles.time}>{time}</span>
        <span className={styles.venue}>{venue.name}</span>
      </div>

      <div className={styles.matchup}>
        <TeamSide
          teamId={teams.away.team.id}
          city={am?.name ?? ""}
          nickname={am?.brief ?? teams.away.team.name}
          wins={teams.away.leagueRecord.wins}
          losses={teams.away.leagueRecord.losses}
          pitcher={awayPitcher?.fullName}
          pitchHand={awayPitchHand}
          color={ac}
          lineupStatus={awayLineupStatus}
        />
        <TeamSide
          teamId={teams.home.team.id}
          city={hm?.name ?? ""}
          nickname={hm?.brief ?? teams.home.team.name}
          wins={teams.home.leagueRecord.wins}
          losses={teams.home.leagueRecord.losses}
          pitcher={homePitcher?.fullName}
          pitchHand={homePitchHand}
          color={hc}
          lineupStatus={homeLineupStatus}
        />
      </div>

      <div className={styles.statbars}>
        <StatBar label="Starters" aVal={awayFipPlus ?? null} hVal={homeFipPlus ?? null} ac={acBar} hc={hcBar} />
        <StatBar
          label="Offense"
          aVal={awayOpsPlus ?? null}
          hVal={homeOpsPlus ?? null}
          ac={acBar}
          hc={hcBar}
        />
        <StatBar label="Bullpen" aVal={null} hVal={null} ac={acBar} hc={hcBar} />
      </div>
    </Link>
  );
}

function TeamSide({
  teamId,
  city,
  nickname,
  wins,
  losses,
  pitcher,
  pitchHand,
  color,
  lineupStatus,
}: {
  teamId: number;
  city: string;
  nickname: string;
  wins: number;
  losses: number;
  pitcher?: string;
  pitchHand?: string;
  color: string;
  lineupStatus?: LineupStatus;
}) {
  return (
    <div className={styles.teamSide}>
      <div
        className={styles.logoWrap}
        style={{ "--team-glow": color } as React.CSSProperties}
      >
        <img
          src={capLogoUrl(teamId)}
          alt={nickname}
          loading="lazy"
          width={40}
          height={40}
        />
      </div>
      <div className={styles.teamCity}>{city}</div>
      <div className={styles.teamNickname}>{nickname.toUpperCase()}</div>
      <div className={styles.teamRecord}>
        {wins}-{losses}
      </div>
      {pitcher && (
        <>
          <div className={styles.pitcher}>{fmtName(pitcher)}</div>
          <div className={styles.pitcherHand}>
            {pitchHand ? `${pitchHand}HP` : "TBD"}
          </div>
        </>
      )}
      {lineupStatus && (
        <div className={lineupStatus === 'confirmed' ? styles.statusConfirmed : styles.statusProjected}>
          {lineupStatus === 'confirmed' ? 'Lineup Confirmado' : 'Lineup Proyectado'}
        </div>
      )}
    </div>
  );
}

function StatBar({ label, aVal, hVal, ac, hc }: {
  label: string; aVal: number | null; hVal: number | null; ac: string; hc: string;
}) {
  return (
    <MatchupBar
      label={label}
      aDisplay={aVal != null ? String(aVal) : "—"}
      hDisplay={hVal != null ? String(hVal) : "—"}
      aw={aVal != null ? opsBarWidth(aVal) : 0}
      hw={hVal != null ? opsBarWidth(hVal) : 0}
      ac={ac}
      hc={hc}
    />
  );
}

/** OPS+ scale 70–130, value 100 → 50% (avg line). */
function opsBarWidth(v: number): number {
  return ((Math.max(70, Math.min(130, v)) - 70) / 60) * 100;
}

function fmtName(n: string): string {
  const parts = n.split(" ");
  return parts.length > 1
    ? `${parts[0].charAt(0)}. ${parts.slice(1).join(" ")}`
    : n;
}

interface GameWithPitcher extends ScheduledGame {
  teams: ScheduledGame["teams"] & {
    away: ScheduledGame["teams"]["away"] & {
      probablePitcher?: { id: number; fullName: string };
    };
    home: ScheduledGame["teams"]["home"] & {
      probablePitcher?: { id: number; fullName: string };
    };
  };
}
