import { describe, it, expect, beforeAll } from '@jest/globals';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

interface HealthResponse {
  status: string;
  timestamp: string;
}

interface LoginSuccessResponse {
  success: true;
  message: string;
  user: {
    id: number;
    email: string;
    status: string;
  };
}

interface ErrorResponse {
  error: string;
}

describe('AuthService Smoke Tests', () => {
  let isServerReady = false;

  beforeAll(async () => {
    // Wait for server to be ready (max 10 seconds)
    const startTime = Date.now();
    while (Date.now() - startTime < 10000) {
      try {
        const response = await fetch(`${BASE_URL}/health`);
        if (response.ok) {
          isServerReady = true;
          break;
        }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (!isServerReady) {
      throw new Error(`Server at ${BASE_URL} is not ready after 10 seconds`);
    }
  }, 15000);

  describe('GET /health', () => {
    it('should return 200 with status "ok"', async () => {
      const response = await fetch(`${BASE_URL}/health`);
      expect(response.status).toBe(200);

      const data = (await response.json()) as HealthResponse;
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeDefined();
      expect(typeof data.timestamp).toBe('string');
    });
  });

  describe('POST /login - Success', () => {
    it('should return 200 with user data for valid credentials (test@test.com)', async () => {
      const response = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@test.com',
          password: 'password123',
        }),
      });

      expect(response.status).toBe(200);

      const data = (await response.json()) as LoginSuccessResponse;
      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe('test@test.com');
      expect(data.user.status).toBe('active');
      expect(typeof data.user.id).toBe('number');
    });

    it('should return 200 with user data for valid admin credentials (admin@test.com)', async () => {
      const response = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@test.com',
          password: 'adminpass',
        }),
      });

      expect(response.status).toBe(200);

      const data = (await response.json()) as LoginSuccessResponse;
      expect(data.success).toBe(true);
      expect(data.user.email).toBe('admin@test.com');
      expect(data.user.status).toBe('active');
    });
  });

  describe('POST /login - Invalid Credentials', () => {
    it('should return 401 for invalid password', async () => {
      const response = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@test.com',
          password: 'wrongpassword',
        }),
      });

      expect(response.status).toBe(401);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBeDefined();
    });

    it('should return 401 for non-existent user', async () => {
      const response = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@test.com',
          password: 'password123',
        }),
      });

      expect(response.status).toBe(401);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBeDefined();
    });
  });

  describe('POST /login - Blocked User', () => {
    it('should return 403 for blocked user (blocked@test.com)', async () => {
      const response = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'blocked@test.com',
          password: 'password123',
        }),
      });

      expect(response.status).toBe(403);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBeDefined();
    });
  });

  describe('POST /login - Missing/Invalid Input', () => {
    it('should return 400 when password is missing', async () => {
      const response = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@test.com',
        }),
      });

      expect(response.status).toBe(400);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBeDefined();
    });

    it('should return 400 when email is missing', async () => {
      const response = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'password123',
        }),
      });

      expect(response.status).toBe(400);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBeDefined();
    });

    it('should return 400 for empty request body', async () => {
      const response = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);

      const data = (await response.json()) as ErrorResponse;
      expect(data.error).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent endpoint', async () => {
      const response = await fetch(`${BASE_URL}/nonexistent`, {
        method: 'GET',
      });

      expect(response.status).toBe(404);
    });

    it('should return 404 for POST to non-existent endpoint', async () => {
      const response = await fetch(`${BASE_URL}/api/invalid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(404);
    });
  });
});
