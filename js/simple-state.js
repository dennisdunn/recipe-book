// What the simple view's Home offers, worked out from the week. Pure (no DOM or storage) and covered in tests/.

/** A day still to be chosen: not skipped, and its recipe (if any) is no longer, or never was, in the book. */
export const isOpenDay = (day, inBook) => !day.skip && !inBook(day.recipeId);

/**
 * @param week   the simple week's days ({ date, recipeId, skip }); before any plan exists, its dates as open days
 * @param dates  the dates the simple view plans for (menuDates)
 * @param today  'YYYY-MM-DD'
 * @param inBook recipeId => whether that recipe is in the book
 * @returns {{
 *   tonightDay,                       // today's day in the week, unless skipped or not a dinner day
 *   tonight: 'cook' | 'choose' | null, // "Show me how to make it" / "Choose tonight's dinner" / nothing to do
 *   week: 'choose-first' | 'choose-next' | 'change' | null, // the week's button; null when tonight's is the next one
 *   weekIsPrimary,                    // the week's button is the main one when Tonight has none
 *   canPrint,                         // "Print the shopping list": once a dinner is chosen
 *   thisWeek,                         // the week includes today (else it is next week's)
 * }}
 */
export function homeState(week, dates, today, inBook) {
  const tonightDay = week.find(d => d.date === today && !d.skip) ?? null;
  const anyChosen = week.some(d => inBook(d.recipeId));
  const nextOpen = week.find(d => isOpenDay(d, inBook));
  const tonight = !tonightDay ? null : inBook(tonightDay.recipeId) ? 'cook' : 'choose';
  const weekAction = !nextOpen ? 'change' : nextOpen === tonightDay ? null : anyChosen ? 'choose-next' : 'choose-first';
  return { tonightDay, tonight, week: weekAction, weekIsPrimary: !tonight, canPrint: anyChosen, thisWeek: dates.includes(today) };
}
