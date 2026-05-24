export class AmoCrmError extends Error {
  constructor(
    message: string,
    public readonly status = 0,
    public readonly bodySnippet?: string,
  ) {
    super(message);
    this.name = 'AmoCrmError';
  }
}
