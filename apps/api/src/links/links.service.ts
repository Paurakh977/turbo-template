import { Injectable, NotFoundException } from '@nestjs/common';
import { Link, CreateLinkDto, UpdateLinkDto } from '@repo/api';

@Injectable()
export class LinksService {
  private readonly links: Link[] = [
    {
      id: 0,
      title: 'Installation',
      url: 'https://turborepo.dev/docs/getting-started/installation',
      description: 'Get started with Turborepo in a few moments using',
    },
    {
      id: 1,
      title: 'Crafting',
      url: 'https://turborepo.dev/docs/crafting-your-repository',
      description: 'Architecting a monorepo is a careful process.',
    },
    {
      id: 2,
      title: 'Add Repositories',
      url: 'https://turborepo.dev/docs/getting-started/add-to-existing-repository',
      description:
        'Turborepo can be incrementally adopted in any repository, single or multi-package, to speed up the developer and CI workflows of the repository.',
    },
  ];

  private nextId = 3;

  create(dto: CreateLinkDto): Link {
    const link: Link = {
      id: this.nextId++,
      title: dto.title,
      url: dto.url,
      description: dto.description ?? '',
    };

    this.links.push(link);

    return link;
  }

  findAll(): Link[] {
    return this.links;
  }

  findOne(id: number): Link {
    const link = this.links.find((link) => link.id === id);

    if (!link) {
      throw new NotFoundException(`Link #${id} not found`);
    }

    return link;
  }

  update(id: number, dto: UpdateLinkDto): Link {
    const link = this.findOne(id);

    if (dto.title !== undefined) {
      link.title = dto.title;
    }

    if (dto.url !== undefined) {
      link.url = dto.url;
    }

    if (dto.description !== undefined) {
      link.description = dto.description;
    }

    return link;
  }

  remove(id: number): { deleted: true; id: number } {
    const index = this.links.findIndex((link) => link.id === id);

    if (index === -1) {
      throw new NotFoundException(`Link #${id} not found`);
    }

    this.links.splice(index, 1);

    return { deleted: true, id };
  }
}
