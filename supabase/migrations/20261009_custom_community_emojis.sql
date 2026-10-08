-- Allow the original SA Recruiters emoji pack as per-user post reactions.
-- Existing Like rows remain valid; the existing one-reaction-per-user rule remains.
alter table public.community_post_reactions
  drop constraint if exists community_post_reactions_reaction_type_check;
alter table public.community_post_reactions
  add constraint community_post_reactions_reaction_type_check
  check (reaction_type in ('like', 'join', 'good-luck', 'interview-win', 'ask-question', 'applause'));
