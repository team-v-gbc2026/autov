-- Retire the pre-Eve generation tables. `save_generation` was their only writer
-- and was dropped in 20260913155332; `effect_versions` never had a writer at all.
-- Which board images an effect was built from now comes from
-- studio_operations.input->'referenceIds', which the agent records per operation.
drop table if exists public.effect_versions;
drop table if exists public.generation_inputs;
drop table if exists public.generations;
