import { relations } from 'drizzle-orm';
import {
  delivery,
  dismissal,
  dismissalFielder,
  innings,
  inningsExtras,
  match,
  matchOfficial,
  official,
  player,
  season,
  seasonSquad,
  team,
  venue,
} from './core.js';

export const seasonRelations = relations(season, ({ many }) => ({
  matches: many(match),
  squads: many(seasonSquad),
}));

export const teamRelations = relations(team, ({ many }) => ({
  squads: many(seasonSquad),
}));

export const matchRelations = relations(match, ({ one, many }) => ({
  season: one(season, { fields: [match.seasonId], references: [season.id] }),
  venue: one(venue, { fields: [match.venueId], references: [venue.id] }),
  teamA: one(team, { fields: [match.teamAId], references: [team.id], relationName: 'teamA' }),
  teamB: one(team, { fields: [match.teamBId], references: [team.id], relationName: 'teamB' }),
  winner: one(team, { fields: [match.winnerId], references: [team.id], relationName: 'winner' }),
  tossWinner: one(team, {
    fields: [match.tossWinnerId],
    references: [team.id],
    relationName: 'tossWinner',
  }),
  referee: one(official, { fields: [match.refereeId], references: [official.id] }),
  innings: many(innings),
  officials: many(matchOfficial),
}));

export const matchOfficialRelations = relations(matchOfficial, ({ one }) => ({
  match: one(match, { fields: [matchOfficial.matchId], references: [match.id] }),
  official: one(official, { fields: [matchOfficial.officialId], references: [official.id] }),
}));

export const seasonSquadRelations = relations(seasonSquad, ({ one }) => ({
  season: one(season, { fields: [seasonSquad.seasonId], references: [season.id] }),
  team: one(team, { fields: [seasonSquad.teamId], references: [team.id] }),
  player: one(player, { fields: [seasonSquad.playerId], references: [player.id] }),
}));

export const inningsRelations = relations(innings, ({ one, many }) => ({
  match: one(match, { fields: [innings.matchId], references: [match.id] }),
  battingTeam: one(team, {
    fields: [innings.battingTeamId],
    references: [team.id],
    relationName: 'battingTeam',
  }),
  bowlingTeam: one(team, {
    fields: [innings.bowlingTeamId],
    references: [team.id],
    relationName: 'bowlingTeam',
  }),
  extras: one(inningsExtras, {
    fields: [innings.id],
    references: [inningsExtras.inningsId],
  }),
  deliveries: many(delivery),
  dismissals: many(dismissal),
}));

export const deliveryRelations = relations(delivery, ({ one, many }) => ({
  innings: one(innings, { fields: [delivery.inningsId], references: [innings.id] }),
  striker: one(player, {
    fields: [delivery.strikerId],
    references: [player.id],
    relationName: 'striker',
  }),
  nonStriker: one(player, {
    fields: [delivery.nonStrikerId],
    references: [player.id],
    relationName: 'nonStriker',
  }),
  bowler: one(player, {
    fields: [delivery.bowlerId],
    references: [player.id],
    relationName: 'bowler',
  }),
  dismissals: many(dismissal),
}));

export const dismissalRelations = relations(dismissal, ({ one, many }) => ({
  innings: one(innings, { fields: [dismissal.inningsId], references: [innings.id] }),
  delivery: one(delivery, { fields: [dismissal.deliveryId], references: [delivery.id] }),
  playerOut: one(player, {
    fields: [dismissal.playerOutId],
    references: [player.id],
    relationName: 'playerOut',
  }),
  bowler: one(player, {
    fields: [dismissal.bowlerId],
    references: [player.id],
    relationName: 'dismissalBowler',
  }),
  fielders: many(dismissalFielder),
}));

export const dismissalFielderRelations = relations(dismissalFielder, ({ one }) => ({
  dismissal: one(dismissal, {
    fields: [dismissalFielder.dismissalId],
    references: [dismissal.id],
  }),
  player: one(player, { fields: [dismissalFielder.playerId], references: [player.id] }),
}));
