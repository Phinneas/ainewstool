/**
 * Logger adapter for Workers environment
 * Replaces the Node.js logger with Workers console
 */

export interface LogEntry {
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  timestamp: number;
  data?: Record<string, any>;
}

export class Logger {
  private context: string;
  
  constructor(context: string = 'worker') {
    this.context = context;
  }
  
  info(message: string, data?: Record<string, any>): void {
    const entry = this.createEntry('info', message, data);
    console.log(JSON.stringify(entry));
  }
  
  warn(message: string, data?: Record<string, any>): void {
    const entry = this.createEntry('warn', message, data);
    console.warn(JSON.stringify(entry));
  }
  
  error(message: string, data?: Record<string, any>): void {
    const entry = this.createEntry('error', message, data);
    console.error(JSON.stringify(entry));
  }
  
  debug(message: string, data?: Record<string, any>): void {
    const entry = this.createEntry('debug', message, data);
    console.debug(JSON.stringify(entry));
  }
  
  timer(name: string): { end: () => void } {
    const start = Date.now();
    return {
      end: () => {
        const duration = Date.now() - start;
        this.info(`${name} completed`, { duration_ms: duration });
      },
    };
  }
  
  private createEntry(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    data?: Record<string, any>
  ): LogEntry {
    return {
      message: `[${this.context}] ${message}`,
      level,
      timestamp: Date.now(),
      ...(data && { data }),
    };
  }
}

export const log = new Logger('ainewsletter');
