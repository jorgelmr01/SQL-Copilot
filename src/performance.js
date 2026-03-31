// Performance optimization utilities for SQL Copilot
// Implements debouncing, caching, and performance monitoring

class PerformanceOptimizer {
  constructor() {
    this.cache = new Map();
    this.debounceTimers = new Map();
    this.metrics = {
      renderCount: 0,
      parseCount: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    this.performanceThresholds = {
      renderTime: 16, // 60fps = 16ms per frame
      parseTime: 100,
      cacheSize: 1000
    };
  }

  // Debounce expensive operations
  debounce(key, func, delay = 300) {
    if (this.debounceTimers.has(key)) {
      clearTimeout(this.debounceTimers.get(key));
    }
    
    const timer = setTimeout(() => {
      func();
      this.debounceTimers.delete(key);
    }, delay);
    
    this.debounceTimers.set(key, timer);
  }

  // Cache expensive computations
  cache(key, computeFn) {
    if (this.cache.has(key)) {
      this.metrics.cacheHits++;
      return this.cache.get(key);
    }
    
    const result = computeFn();
    this.cache.set(key, result);
    this.metrics.cacheMisses++;
    
    // Cleanup old cache entries if too large
    if (this.cache.size > this.performanceThresholds.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    return result;
  }

  // Performance monitoring wrapper
  monitor(operationName, fn) {
    const start = performance.now();
    const result = fn();
    const end = performance.now();
    const duration = end - start;
    
    if (duration > this.performanceThresholds[operationName]) {
      console.warn(`Slow operation: ${operationName} took ${duration.toFixed(2)}ms`);
    }
    
    return result;
  }

  // Throttle rapid operations (like mouse moves)
  throttle(key, func, limit = 16) {
    let inThrottle = false;
    return (...args) => {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  // Clear cache for specific keys or all
  clearCache(keyPattern = null) {
    if (keyPattern) {
      for (const key of this.cache.keys()) {
        if (key.includes(keyPattern)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  // Get performance metrics
  getMetrics() {
    return {
      ...this.metrics,
      cacheHitRate: this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) * 100,
      cacheSize: this.cache.size
    };
  }
}

// Global performance optimizer instance
window.Performance = new PerformanceOptimizer();

// Debounced render function for ERD
window.debouncedRenderERD = () => {
  window.Performance.debounce('renderERD', () => {
    if (window.renderERD) {
      window.Performance.monitor('renderTime', () => window.renderERD());
    }
  }, 16); // 60fps
};

// Debounced search functions
window.debouncedSearch = (query, searchFn) => {
  window.Performance.debounce('search', () => searchFn(query), 200);
};

// Cached SQL parsing
window.cachedParseSQL = (sql) => {
  return window.Performance.cache(`parse:${sql}`, () => {
    window.Performance.metrics.parseCount++;
    if (window.SQLCopilotV2 && window.SQLCopilotV2.SQLParser) {
      return window.SQLCopilotV2.SQLParser.parse(sql);
    }
    return null;
  });
};

// Performance monitoring for development
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  setInterval(() => {
    const metrics = window.Performance.getMetrics();
    console.log('Performance Metrics:', metrics);
  }, 10000);
}
