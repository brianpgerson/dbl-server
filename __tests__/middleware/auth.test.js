const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../../middleware/auth');

// Mock JWT_SECRET for testing
process.env.JWT_SECRET = 'test-secret';

describe('authenticateToken', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  test('returns 401 when no Authorization header', () => {
    authenticateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Access token required' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 403 for invalid token', () => {
    req.headers['authorization'] = 'Bearer invalid-token';
    authenticateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() with valid token and sets req.user', async () => {
    const payload = { userId: 1, email: 'test@test.com', teamIds: [1], commissionerLeagues: [] };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
    req.headers['authorization'] = `Bearer ${token}`;

    authenticateToken(req, res, next);
    await new Promise(r => setTimeout(r, 20));

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe(1);
    expect(req.user.email).toBe('test@test.com');
  });

  test('returns 403 for expired token', async () => {
    const payload = { userId: 1, email: 'test@test.com' };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '-1h' });
    req.headers['authorization'] = `Bearer ${token}`;

    authenticateToken(req, res, next);
    await new Promise(r => setTimeout(r, 20));

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
