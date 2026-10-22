export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  storeIds: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
