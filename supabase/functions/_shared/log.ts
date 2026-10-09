// Structured logging with an allow-list of fields (PRD 9.4 rule 11,
// Appendix A #35). Only these keys can ever reach the logs, so tokens, emails,
// IP addresses, request bodies and database error messages (which can contain
// the values a user typed) cannot be logged by accident.
type LogFields = {
  fn: string;
  ref?: string;
  event?: string;
  status?: number;
  errorType?: string;
  dbCode?: string;
};

export function log(level: 'info' | 'warn' | 'error', fields: LogFields): void {
  const entry = {
    level,
    fn: fields.fn,
    ref: fields.ref,
    event: fields.event,
    status: fields.status,
    errorType: fields.errorType,
    dbCode: fields.dbCode,
  };
  console[level](JSON.stringify(entry));
}
