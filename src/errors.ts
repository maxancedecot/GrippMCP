export class GrippMcpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "GrippMcpError";
  }
}

export function toErrorPayload(error: unknown) {
  if (error instanceof GrippMcpError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null
      }
    };
  }

  if (error instanceof Error) {
    return {
      error: {
        code: "internal_error",
        message: error.message,
        details: null
      }
    };
  }

  return {
    error: {
      code: "internal_error",
      message: "Unknown error",
      details: error
    }
  };
}
