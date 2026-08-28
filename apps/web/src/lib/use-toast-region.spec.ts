/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { useToastRegion } from './use-toast-region';

describe('useToastRegion', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts with empty toasts', () => {
    const { result } = renderHook(() => useToastRegion());
    expect(result.current.toasts).toEqual([]);
  });

  it('pushToast adds a toast', () => {
    const { result } = renderHook(() => useToastRegion());
    act(() => {
      result.current.pushToast('info', 'Hello');
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].kind).toBe('info');
    expect(result.current.toasts[0].message).toBe('Hello');
  });

  it('toast has a unique id', () => {
    const { result } = renderHook(() => useToastRegion());
    act(() => {
      result.current.pushToast('info', 'A');
      result.current.pushToast('error', 'B');
    });
    const ids = result.current.toasts.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dismissToast removes a toast', () => {
    const { result } = renderHook(() => useToastRegion());
    act(() => {
      result.current.pushToast('info', 'Hello');
    });
    const id = result.current.toasts[0].id;
    act(() => {
      result.current.dismissToast(id);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('toast auto-dismisses after TOAST_DURATION_MS', () => {
    const { result } = renderHook(() => useToastRegion());
    act(() => {
      result.current.pushToast('info', 'Auto');
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      jest.advanceTimersByTime(3500);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('multiple toasts can be added and dismissed independently', () => {
    const { result } = renderHook(() => useToastRegion());
    act(() => {
      result.current.pushToast('info', 'First');
      result.current.pushToast('error', 'Second');
    });
    expect(result.current.toasts).toHaveLength(2);

    const firstId = result.current.toasts[0].id;
    act(() => {
      result.current.dismissToast(firstId);
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('Second');
  });
});
