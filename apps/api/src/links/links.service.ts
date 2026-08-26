import { Injectable, NotFoundException } from '@nestjs/common';
import type { Link } from '@repo/api';

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
}
