export const createAuthMiddleware = (fn: any) => fn;
export const getSessionFromCtx = jest.fn();
export class APIError extends Error {
  status: string;
  body: any;
  constructor(status: string, body: any) {
    super(status);
    this.status = status;
    this.body = body;
  }
}
