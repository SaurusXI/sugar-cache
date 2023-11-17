/**
 * Represents a generic logger that could be a simple console, bunyan etc.
 */
export interface Logger {
    debug(_message?: any, ..._optionalParams: any[]): void;
    info(_message?: any, ..._optionalParams: any[]): void;
    warn(_message?: any, ..._optionalParams: any[]): void;
    error(_message?: any, ..._optionalParams: any[]): void;
    [x: string]: any;
  }

/**
   * Dummy logger that does not do anything.
   *
   * Useful as a default for some library that the user might want to get logs out of.
   */
export const dummyLogger: Logger = {
    trace: (_message?: any, ..._optionalParams: any[]) => {},
    debug: (_message?: any, ..._optionalParams: any[]) => {},
    info: (_message?: any, ..._optionalParams: any[]) => {},
    warn: (_message?: any, ..._optionalParams: any[]) => {},
    error: (_message?: any, ..._optionalParams: any[]) => {},
};
