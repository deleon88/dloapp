// MLB image URLs shared by the game page's TV-style cards.
import { isLidomTeam } from '@/data/teams'

/** Cutout portrait (transparent background); MLB serves a generic silhouette when there's none. */
export const cutoutUrl = (id: number, width = 280) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_${width},q_auto:best,f_auto/v1/people/${id}/headshot/silo/current`

/** Team's primary logo, the version made for dark backgrounds (LIDOM clubs only have the base one). */
export const teamLogoUrl = (teamId: number) => isLidomTeam(teamId)
  ? `https://www.mlbstatic.com/team-logos/${teamId}.svg`
  : `https://www.mlbstatic.com/team-logos/team-primary-on-dark/${teamId}.svg`
