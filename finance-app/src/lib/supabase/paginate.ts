// PostgREST отдаёт максимум 1000 строк за запрос. Для агрегирующих выборок
// (отчёты, дашборд за год) этого мало — иначе часть данных молча теряется.
// Помощник тянет все строки постранично через .range().
//
// Использование:
//   const rows = await fetchAllRows<Tx>((from, to) =>
//     supabase.from("transactions").select(SEL).eq("team_id", id).order("occurred_on").range(from, to)
//   );
export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}
