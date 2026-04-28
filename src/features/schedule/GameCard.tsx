import type React from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import type { ScheduledGame } from "@/api/mlb/types";
import { getTeamMeta, getBarColor, capLogoUrl, teamBg } from "@/data/teams";
import MatchupBar from "@/components/MatchupBar/MatchupBar";
import { useT } from "@/i18n/useT";
import styles from "./GameCard.module.css";

export type LineupStatus = 'confirmed' | 'projected'

interface Props {
  game: ScheduledGame;
  awayWrc?: number;
  homeWrc?: number;
  awayFipPlus?: number;
  homeFipPlus?: number;
  awayBullpenFipPlus?: number;
  homeBullpenFipPlus?: number;
  awayPitchHand?: string;
  homePitchHand?: string;
  awayLineupStatus?: LineupStatus;
  homeLineupStatus?: LineupStatus;
  animDelay?: number;
}

export default function GameCard({
  game,
  awayWrc,
  homeWrc,
  awayFipPlus,
  homeFipPlus,
  awayBullpenFipPlus,
  homeBullpenFipPlus,
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

      <StatBars
        awayFipPlus={awayFipPlus}
        homeFipPlus={homeFipPlus}
        awayWrc={awayWrc}
        homeWrc={homeWrc}
        awayBullpenFipPlus={awayBullpenFipPlus}
        homeBullpenFipPlus={homeBullpenFipPlus}
        acBar={acBar}
        hcBar={hcBar}
      />
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
      {lineupStatus && <LineupStatusBadge status={lineupStatus} />}
    </div>
  );
}

function LineupStatusBadge({ status }: { status: LineupStatus }) {
  const t = useT()
  return (
    <div className={status === 'confirmed' ? styles.statusConfirmed : styles.statusProjected}>
      {status === 'confirmed' ? t('lineupConfirmed') : t('lineupProjected')}
    </div>
  )
}

function StatBars({ awayFipPlus, homeFipPlus, awayWrc, homeWrc, awayBullpenFipPlus, homeBullpenFipPlus, acBar, hcBar }: {
  awayFipPlus?: number; homeFipPlus?: number
  awayWrc?: number; homeWrc?: number
  awayBullpenFipPlus?: number; homeBullpenFipPlus?: number
  acBar: string; hcBar: string
}) {
  const t = useT()
  return (
    <div className={styles.statbars}>
      <StatBar label={t('starters')} aVal={awayFipPlus ?? null} hVal={homeFipPlus ?? null} ac={acBar} hc={hcBar} barFn={fipBarWidth} />
      <StatBar label={t('offense')} aVal={awayWrc ?? null} hVal={homeWrc ?? null} ac={acBar} hc={hcBar} barFn={wrcBarWidth} />
      <StatBar label={t('bullpen')} aVal={awayBullpenFipPlus ?? null} hVal={homeBullpenFipPlus ?? null} ac={acBar} hc={hcBar} barFn={fipBarWidth} />
    </div>
  )
}

function StatBar({ label, aVal, hVal, ac, hc, barFn }: {
  label: string; aVal: number | null; hVal: number | null; ac: string; hc: string
  barFn: (v: number) => number
}) {
  return (
    <MatchupBar
      label={label}
      aDisplay={aVal != null ? String(aVal) : "—"}
      hDisplay={hVal != null ? String(hVal) : "—"}
      aw={aVal != null ? barFn(aVal) : 0}
      hw={hVal != null ? barFn(hVal) : 0}
      ac={ac}
      hc={hc}
    />
  );
}

/** wRC+ scale 40–160; value 100 → 50% (matches LineupComparison). */
function wrcBarWidth(v: number): number {
  return ((Math.max(40, Math.min(160, v)) - 40) / 120) * 100;
}

/** FIP+/OPS+ scale 70–130; value 100 → 50%. */
function fipBarWidth(v: number): number {
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
