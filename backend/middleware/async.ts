import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "../auth.js";

/** 
 * Helper to wrap async express handlers to ensure errors are passed to the next() function.
 */
export function withAsyncMiddleware(
    fn: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>,
) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req as AuthenticatedRequest, res, next)).catch(next);
    };
}
