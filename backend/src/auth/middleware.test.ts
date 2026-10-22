import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { requirePermission } from './middleware';

function runPermissionCheck(permissions: string[]) {
  let statusCode = 200;
  let errorBody: unknown;
  let nextCalled = false;
  const req = { user: { permissions } } as unknown as Request;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(body: unknown) { errorBody = body; return this; },
  } as unknown as Response;
  const next = (() => { nextCalled = true; }) as NextFunction;
  requirePermission('dashboard:read')(req, res, next);
  return { statusCode, errorBody, nextCalled };
}

test('allows users with the required permission', () => {
  assert.deepEqual(runPermissionCheck(['dashboard:read']), {
    statusCode: 200,
    errorBody: undefined,
    nextCalled: true,
  });
});

test('rejects users without the required permission', () => {
  const result = runPermissionCheck(['inventory:read']);
  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.errorBody, { error: 'Insufficient permissions' });
  assert.equal(result.nextCalled, false);
});
