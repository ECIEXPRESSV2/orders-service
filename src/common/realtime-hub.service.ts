import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface RealtimeEvent<TPayload = unknown> {
  type: string;
  room?: string;
  payload: TPayload;
  occurredAt: string;
}

@Injectable()
export class RealtimeHubService {
  private readonly eventsSubject = new Subject<RealtimeEvent>();

  publish<TPayload>(event: RealtimeEvent<TPayload>): void {
    this.eventsSubject.next(event);
  }

  stream(): Observable<RealtimeEvent> {
    return this.eventsSubject.asObservable();
  }
}