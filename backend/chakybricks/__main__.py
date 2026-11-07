import argparse
import os
import sys
import threading

TOKEN_ENV = "CHAKYBRICKS_TOKEN"
KERNEL_FLAG = "--kernel"


def _exit_when_stdin_closes() -> None:
    """The desktop shell holds our stdin open; EOF means it has gone away, so we exit too."""
    try:
        while sys.stdin.read(1024):
            pass
    finally:
        os._exit(0)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="chakybricks")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--watch-stdin", action="store_true")
    return parser.parse_args(argv)


def run_kernel(argv: list[str]) -> None:
    """Notebook kernels re-invoke this executable, so the frozen app needs no system Python."""
    from ipykernel.kernelapp import launch_new_instance

    sys.argv = [sys.argv[0], *argv]
    launch_new_instance()


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == KERNEL_FLAG:
        run_kernel(argv[1:])
        return

    import uvicorn

    from chakybricks.app import create_app

    args = parse_args(argv)
    token = os.environ.get(TOKEN_ENV)
    if not token:
        sys.exit(f"{TOKEN_ENV} must be set")
    if args.watch_stdin:
        threading.Thread(target=_exit_when_stdin_closes, daemon=True).start()
    uvicorn.run(create_app(token), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
