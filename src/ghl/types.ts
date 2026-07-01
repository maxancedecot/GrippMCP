import { JsonValue } from "../types.js";

export type GhlTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
  refreshTokenId?: string;
  userType?: "Company" | "Location" | string;
  companyId?: string;
  locationId?: string;
  userId?: string;
  traceId?: string;
  isBulkInstallation?: boolean;
};

export type GhlTokenRecord = {
  installId: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: number;
  scope?: string;
  refreshTokenId?: string;
  userType?: string;
  companyId?: string;
  locationId?: string;
  userId?: string;
  createdAt: number;
  updatedAt: number;
};

export type GhlApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type GhlApiCallInput = {
  method: GhlApiMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: JsonValue;
  apiVersion?: string;
  confirm?: boolean;
  readOnly?: boolean;
};
