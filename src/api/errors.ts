/** INPUT: 固定公开错误信息。 OUTPUT: ApiError。 POSITION: EP7 HTTP 状态边界，不暴露底层异常。 SYNC: 同步 folder.md。 */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
