/** An error whose message is plain English, safe to show the user, and says what to do next. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export function errorResult(error: unknown) {
  const text =
    error instanceof UserError
      ? error.message
      : "Something went wrong while reading this payment request. Nothing was paid. Check the link and try again.";
  if (!(error instanceof UserError)) console.error("scanpay internal error:", error instanceof Error ? error.message : String(error));
  return { isError: true as const, content: [{ type: "text" as const, text }] };
}
