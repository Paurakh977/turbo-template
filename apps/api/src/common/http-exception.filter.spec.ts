import { HttpExceptionFilter } from './http-exception.filter';
import {
  HttpException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';

function createMockHost(
  status: number = 200,
  url: string = '/api/test',
  method: string = 'GET',
) {
  const jsonFn = jest.fn();
  const statusFn = jest.fn().mockReturnValue({ json: jsonFn });
  return {
    switchToHttp: () => ({
      getResponse: () => ({
        status: statusFn,
      }),
      getRequest: () => ({
        url,
        method,
      }),
    }),
    _jsonFn: jsonFn,
    _statusFn: statusFn,
  };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('handles HttpException with string response', () => {
    const host = createMockHost();
    const exception = new HttpException('Bad request', 400);

    filter.catch(exception, host as any);

    expect(host._statusFn).toHaveBeenCalledWith(400);
    expect(host._jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Bad request',
        statusCode: 400,
        path: '/api/test',
      }),
    );
  });

  it('handles HttpException with object response', () => {
    const host = createMockHost();
    const exception = new BadRequestException({
      message: ['title should not be empty'],
      error: 'Bad Request',
    });

    filter.catch(exception, host as any);

    expect(host._statusFn).toHaveBeenCalledWith(400);
    expect(host._jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: ['title should not be empty'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );
  });

  it('handles NotFoundException (404)', () => {
    const host = createMockHost();
    const exception = new NotFoundException('User not found');

    filter.catch(exception, host as any);

    expect(host._statusFn).toHaveBeenCalledWith(404);
    expect(host._jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'User not found',
        statusCode: 404,
      }),
    );
  });

  it('handles ForbiddenException (403)', () => {
    const host = createMockHost();
    const exception = new ForbiddenException('Insufficient permissions');

    filter.catch(exception, host as any);

    expect(host._statusFn).toHaveBeenCalledWith(403);
  });

  it('handles unknown exception as 500', () => {
    const host = createMockHost();
    const exception = new Error('Something broke');

    filter.catch(exception, host as any);

    expect(host._statusFn).toHaveBeenCalledWith(500);
    expect(host._jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Internal server error',
        statusCode: 500,
      }),
    );
  });

  it('handles non-Error unknown exception as 500', () => {
    const host = createMockHost();

    filter.catch('string error', host as any);

    expect(host._statusFn).toHaveBeenCalledWith(500);
    expect(host._jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Internal server error',
        statusCode: 500,
      }),
    );
  });

  it('includes timestamp in response', () => {
    const host = createMockHost();
    const exception = new HttpException('Error', 400);

    filter.catch(exception, host as any);

    const call = host._jsonFn.mock.calls[0][0];
    expect(call.timestamp).toBeDefined();
    expect(new Date(call.timestamp).toISOString()).toBe(call.timestamp);
  });

  it('includes request path in response', () => {
    const host = createMockHost(200, '/api/users/123');
    const exception = new HttpException('Error', 422);

    filter.catch(exception, host as any);

    expect(host._jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/users/123' }),
    );
  });

  it('does not let exception body spoof statusCode', () => {
    const host = createMockHost();
    const exception = new HttpException(
      { message: 'Fake', statusCode: 200 },
      400,
    );

    filter.catch(exception, host as any);

    const call = host._jsonFn.mock.calls[0][0];
    expect(call.statusCode).toBe(400);
  });

  it('handles InternalServerErrorException (500)', () => {
    const host = createMockHost();
    const exception = new InternalServerErrorException();

    filter.catch(exception, host as any);

    expect(host._statusFn).toHaveBeenCalledWith(500);
    expect(host._jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500 }),
    );
  });
});
