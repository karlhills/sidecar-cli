export class SidecarError extends Error {
  constructor(message: string, public code = 'SIDE_CAR_ERROR', public exitCode = 1) {
    super(message);
    this.name = 'SidecarError';
  }
}
