import { useEffect, useRef } from 'react'

export function useDebounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const funcRef = useRef(func)

  // Update the function reference
  useEffect(() => {
    funcRef.current = func
  }, [func])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const debouncedFunction = ((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      funcRef.current(...args)
    }, delay)
  }) as T

  return debouncedFunction
}