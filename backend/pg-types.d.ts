declare module 'pg' {
  export class Pool {
    query(text: string, params?: any[]): Promise<any>;
    connect(): Promise<any>;
    end(): Promise<void>;
  }
}
