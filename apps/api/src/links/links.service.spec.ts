import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LinksService } from './links.service';

describe('LinksService', () => {
  let service: LinksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LinksService],
    }).compile();

    service = module.get<LinksService>(LinksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns an array of links', () => {
      const links = service.findAll();
      expect(Array.isArray(links)).toBe(true);
      expect(links.length).toBeGreaterThan(0);
    });

    it('each link has id, title, url, description', () => {
      const links = service.findAll();
      for (const link of links) {
        expect(link).toHaveProperty('id');
        expect(link).toHaveProperty('title');
        expect(link).toHaveProperty('url');
        expect(link).toHaveProperty('description');
      }
    });
  });

  describe('findOne', () => {
    it('returns the first link', () => {
      const link = service.findOne(0);
      expect(link.id).toBe(0);
      expect(link.title).toBeTruthy();
    });

    it('throws NotFoundException for missing id', () => {
      expect(() => service.findOne(999)).toThrow(NotFoundException);
    });

    it('throws with correct message', () => {
      try {
        service.findOne(42);
      } catch (e: any) {
        expect(e.message).toContain('Link #42 not found');
      }
    });
  });
});
