class ChakyError(Exception):
    status_code = 400


class NotFoundError(ChakyError):
    status_code = 404


class ConflictError(ChakyError):
    status_code = 409


class InvalidInputError(ChakyError):
    status_code = 422
