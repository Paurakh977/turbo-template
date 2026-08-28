jest.mock('@repo/database', () => ({
  db: {
    $queryRaw: jest.fn(),
  },
}));

import { HealthController } from './health.controller';
import { db } from '@repo/database';
import { ServiceUnavailableException } from '@nestjs/common';

function makeRedisMock(overrides: { ping?: jest.fn } = {}) {
  return {
    ping: overrides.ping ?? jest.fn().mockResolvedValue('PONG'),
  } as any;
}

describe('HealthController', () => {
  let controller: HealthController;
  let redisMock: ReturnType<typeof makeRedisMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    redisMock = makeRedisMock();
    controller = new HealthController(redisMock);
  });

  describe('live', () => {
    it('returns status ok', () => {
      expect(controller.live()).toEqual({ status: 'ok' });
    });
  });

  describe('ready', () => {
    it('returns ready when all checks pass', async () => {
      redisMock.ping.mockResolvedValue('PONG');
      (db.$queryRaw as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);

      const result = await controller.ready();

      expect(result).toEqual({
        status: 'ready',
        checks: { redis: 'ok', database: 'ok' },
      });
    });

    it('throws ServiceUnavailableException when redis fails', async () => {
      redisMock.ping.mockRejectedValue(new Error('ECONNREFUSED'));
      (db.$queryRaw as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);

      await expect(controller.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException when database fails', async () => {
      redisMock.ping.mockResolvedValue('PONG');
      (db.$queryRaw as jest.Mock).mockRejectedValue(
        new Error('Connection refused'),
      );

      await expect(controller.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws when both redis and database fail', async () => {
      redisMock.ping.mockRejectedValue(new Error('timeout'));
      (db.$queryRaw as jest.Mock).mockRejectedValue(new Error('db down'));

      await expect(controller.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('reports error status for redis on non-PONG response', async () => {
      redisMock.ping.mockResolvedValue('NOT_PONG');
      (db.$queryRaw as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);

      await expect(controller.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('handles redis timeout', async () => {
      redisMock.ping.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
      );
      (db.$queryRaw as jest.Mock).mockResolvedValue([{ '?column?': 1 }]);

      await expect(controller.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
    }, 5000);
  });
});
