// The 18+ check (PRD 5.1, section 12).
//
// The date of birth is typed on the phone and checked here, on the phone. It
// is never sent anywhere or saved: the server only ever receives "over 18:
// yes" (Appendix A #48). Like any age check without ID, it relies on people
// telling the truth, so it is a declaration, not proof.
//
// Pure module so it can be unit tested in Node.

export type DateParts = { day: number; month: number; year: number };
export type AgeCheck = 'invalid' | 'under18' | 'ok';

export const MIN_AGE = 18;

function isRealDate({ day, month, year }: DateParts): boolean {
  if (![day, month, year].every(Number.isInteger)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this month (handles leap years).
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

// "today" is the phone's local calendar date. Someone born on 29 February
// turns 18 on 1 March in a non-leap year, matching UK practice.
export function checkAge(dob: DateParts, today: DateParts): AgeCheck {
  if (!isRealDate(dob) || dob.year < 1900) return 'invalid';
  const born = dob.year * 10000 + dob.month * 100 + dob.day;
  const now = today.year * 10000 + today.month * 100 + today.day;
  if (born > now) return 'invalid';

  let age = today.year - dob.year;
  const hadBirthdayThisYear =
    today.month > dob.month || (today.month === dob.month && today.day >= dob.day);
  if (!hadBirthdayThisYear) age -= 1;
  if (dob.month === 2 && dob.day === 29 && !isRealDate({ day: 29, month: 2, year: today.year })) {
    // Non-leap year: the birthday counts from 1 March.
    age = today.year - dob.year - (today.month >= 3 ? 0 : 1);
  }
  return age >= MIN_AGE ? 'ok' : 'under18';
}

export function todayParts(now: Date = new Date()): DateParts {
  return { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() };
}
