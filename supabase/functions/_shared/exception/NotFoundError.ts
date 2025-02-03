class NotFoundError extends Error {
  public constructor(message: string = "Not found") {
    super(message)
  }
}

export default NotFoundError
