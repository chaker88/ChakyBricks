from __future__ import annotations

from datetime import datetime
from typing import Literal

from apscheduler.triggers.base import BaseTrigger
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from pydantic import BaseModel, Field, field_validator
from tzlocal import get_localzone

from chakybricks.errors import InvalidInputError

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
CRON_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
MIN_INTERVAL_MINUTES = 1
MAX_INTERVAL_MINUTES = 7 * 24 * 60

ScheduleType = Literal["manual", "interval", "daily", "weekly", "monthly", "cron"]


class Schedule(BaseModel):
    """When a job runs: a simple preset, a five-field cron expression, or only on demand."""

    type: ScheduleType = "manual"
    minutes: int | None = Field(default=None, ge=MIN_INTERVAL_MINUTES, le=MAX_INTERVAL_MINUTES)
    time: str | None = None
    days: list[int] | None = None
    day: int | None = Field(default=None, ge=1, le=31)
    expression: str | None = Field(default=None, max_length=120)

    @field_validator("time")
    @classmethod
    def _time(cls, value: str | None) -> str | None:
        if value is None:
            return None
        _hour_minute(value)
        return value

    @field_validator("days")
    @classmethod
    def _days(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and (not value or any(d < 0 or d > 6 for d in value)):
            raise ValueError("Choose weekdays between Monday (0) and Sunday (6)")
        return sorted(set(value)) if value else value

    def validated(self) -> Schedule:
        """Checks that the fields the chosen type needs are present; returns self."""
        if self.type == "interval" and self.minutes is None:
            raise InvalidInputError("Choose how many minutes between runs")
        if self.type in ("daily", "weekly", "monthly") and self.time is None:
            raise InvalidInputError("Choose a time of day")
        if self.type == "weekly" and not self.days:
            raise InvalidInputError("Choose at least one weekday")
        if self.type == "monthly" and self.day is None:
            raise InvalidInputError("Choose a day of the month")
        if self.type == "cron":
            if not (self.expression or "").strip():
                raise InvalidInputError("Enter a cron expression")
            self.trigger()
        return self

    def trigger(self) -> BaseTrigger | None:
        zone = get_localzone()
        if self.type == "manual":
            return None
        if self.type == "interval":
            return IntervalTrigger(minutes=self.minutes or 1, timezone=zone)
        if self.type == "cron":
            try:
                return CronTrigger.from_crontab((self.expression or "").strip(), timezone=zone)
            except ValueError as exc:
                raise InvalidInputError(f"Invalid cron expression: {exc}") from exc
        hour, minute = _hour_minute(self.time or "00:00")
        if self.type == "daily":
            return CronTrigger(hour=hour, minute=minute, timezone=zone)
        if self.type == "weekly":
            names = ",".join(CRON_NAMES[d] for d in self.days or [])
            return CronTrigger(day_of_week=names, hour=hour, minute=minute, timezone=zone)
        return CronTrigger(day=self.day, hour=hour, minute=minute, timezone=zone)

    def describe(self) -> str:
        if self.type == "manual":
            return "Manual only"
        if self.type == "interval":
            minutes = self.minutes or 1
            if minutes % 60 == 0:
                hours = minutes // 60
                return "Every hour" if hours == 1 else f"Every {hours} hours"
            return "Every minute" if minutes == 1 else f"Every {minutes} minutes"
        if self.type == "daily":
            return f"Every day at {self.time}"
        if self.type == "weekly":
            days = [WEEKDAYS[d][:3] for d in self.days or []]
            return f"Every {', '.join(days)} at {self.time}"
        if self.type == "monthly":
            return f"Day {self.day} of every month at {self.time}"
        return f"Cron: {self.expression}"

    def next_runs(self, count: int = 5, now: datetime | None = None) -> list[datetime]:
        trigger = self.trigger()
        if trigger is None:
            return []
        runs: list[datetime] = []
        previous: datetime | None = None
        current = now or datetime.now(get_localzone())
        for _ in range(count):
            following = trigger.get_next_fire_time(previous, current)
            if following is None:
                break
            runs.append(following)
            previous, current = following, following
        return runs


def _hour_minute(value: str) -> tuple[int, int]:
    try:
        hour_text, minute_text = value.split(":")
        hour, minute = int(hour_text), int(minute_text)
    except ValueError as exc:
        raise ValueError("Time must look like 14:30") from exc
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError("Time must look like 14:30")
    return hour, minute
