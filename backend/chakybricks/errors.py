class ChakyError(Exception):
    status_code = 400


class NotFoundError(ChakyError):
    status_code = 404


class ConflictError(ChakyError):
    status_code = 409


class InvalidInputError(ChakyError):
    status_code = 422


class QueryError(ChakyError):
    status_code = 400


class QueryCancelledError(ChakyError):
    status_code = 499

    def __init__(self) -> None:
        super().__init__("Query cancelled")
