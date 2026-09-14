-- Eve owns new conversations; retain all historical generation tables and rows.
drop function public.save_generation(uuid, text, uuid[]);
