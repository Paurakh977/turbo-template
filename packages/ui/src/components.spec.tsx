import React from 'react';
import { render } from '@testing-library/react';
import { Button } from './button';
import { Card } from './card';
import { Code } from './code';
import { FeatureCard } from './feature-card';

describe('Button', () => {
  it('renders children text', () => {
    const { getByRole } = render(
      <Button appName="TestApp">Click me</Button>,
    );
    expect(getByRole('button').textContent).toBe('Click me');
  });

  it('applies className', () => {
    const { getByRole } = render(
      <Button appName="TestApp" className="my-class">Btn</Button>,
    );
    expect(getByRole('button').className).toContain('my-class');
  });

  it('has empty className when not provided', () => {
    const { getByRole } = render(
      <Button appName="TestApp">Btn</Button>,
    );
    expect(getByRole('button').className).toBe('');
  });
});

describe('Card', () => {
  it('renders as a link', () => {
    const { getByRole } = render(
      <Card title="My Card" href="/test">Card content</Card>,
    );
    expect(getByRole('link')).toBeTruthy();
  });

  it('includes href with UTM params', () => {
    const { getByRole } = render(
      <Card title="Card" href="/docs">Content</Card>,
    );
    expect(getByRole('link').getAttribute('href')).toContain(
      '/docs?utm_source=',
    );
  });

  it('opens in new tab', () => {
    const { getByRole } = render(
      <Card title="Card" href="/test">Content</Card>,
    );
    const link = getByRole('link');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('applies className', () => {
    const { getByRole } = render(
      <Card title="Card" href="/test" className="custom">Content</Card>,
    );
    expect(getByRole('link').className).toContain('custom');
  });
});

describe('Code', () => {
  it('renders children in a code element', () => {
    const { container } = render(<Code>const x = 1;</Code>);
    expect(container.querySelector('code')?.textContent).toBe('const x = 1;');
  });

  it('applies className', () => {
    const { container } = render(<Code className="highlight">code</Code>);
    expect(container.querySelector('code')?.className).toContain('highlight');
  });
});

describe('FeatureCard', () => {
  it('renders title', () => {
    const { getByText } = render(
      <FeatureCard
        icon={<span>icon</span>}
        title="Feature"
        description="Description text"
      />,
    );
    expect(getByText('Feature')).toBeTruthy();
  });

  it('renders description', () => {
    const { getByText } = render(
      <FeatureCard
        icon={<span />}
        title="F"
        description="Feature description here"
      />,
    );
    expect(getByText('Feature description here')).toBeTruthy();
  });

  it('renders icon', () => {
    const { getByText } = render(
      <FeatureCard
        icon={<span>star</span>}
        title="F"
        description="D"
      />,
    );
    expect(getByText('star')).toBeTruthy();
  });
});
