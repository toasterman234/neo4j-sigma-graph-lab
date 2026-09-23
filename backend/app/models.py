"""Domain models for Personal Knowledge — auto-generated from ontology."""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

class Person(BaseModel):
    """Entity model for Person."""

    name: str = Field(...)
    email: str | None = None
    role: str | None = None
    description: str | None = None

class Organization(BaseModel):
    """Entity model for Organization."""

    name: str = Field(...)
    description: str | None = None
    industry: str | None = None

class Location(BaseModel):
    """Entity model for Location."""

    name: str = Field(...)
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None

class Event(BaseModel):
    """Entity model for Event."""

    name: str = Field(...)
    date: datetime | None = None
    description: str | None = None

class Object(BaseModel):
    """Entity model for Object."""

    name: str = Field(...)
    description: str | None = None

class NoteNoteTypeEnum(str, Enum):
    FLEETING = "fleeting"
    LITERATURE = "literature"
    PERMANENT = "permanent"
    REFERENCE = "reference"
    MEETING = "meeting"

class Note(BaseModel):
    """Entity model for Note."""

    note_id: str = Field(...)
    title: str = Field(...)
    content: str | None = None
    created_at: datetime = Field(...)
    updated_at: datetime | None = None
    note_type: NoteNoteTypeEnum | None = None

class ContactRelationshipEnum(str, Enum):
    FRIEND = "friend"
    COLLEAGUE = "colleague"
    FAMILY = "family"
    MENTOR = "mentor"
    ACQUAINTANCE = "acquaintance"
    CLIENT = "client"

class Contact(BaseModel):
    """Entity model for Contact."""

    contact_id: str = Field(...)
    name: str = Field(...)
    email: str | None = None
    relationship: ContactRelationshipEnum | None = None
    organization: str | None = None
    last_contact: date | None = None

class ProjectStatusEnum(str, Enum):
    PLANNING = "planning"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    ARCHIVED = "archived"

class Project(BaseModel):
    """Entity model for Project."""

    project_id: str = Field(...)
    name: str = Field(...)
    description: str | None = None
    status: ProjectStatusEnum | None = None
    started_at: date | None = None
    deadline: date | None = None

class TopicCategoryEnum(str, Enum):
    TECHNOLOGY = "technology"
    SCIENCE = "science"
    PHILOSOPHY = "philosophy"
    BUSINESS = "business"
    HEALTH = "health"
    ART = "art"
    PERSONAL = "personal"

class Topic(BaseModel):
    """Entity model for Topic."""

    topic_id: str = Field(...)
    name: str = Field(...)
    category: TopicCategoryEnum | None = None
    description: str | None = None

class BookmarkReadStatusEnum(str, Enum):
    UNREAD = "unread"
    READING = "reading"
    READ = "read"
    ARCHIVED = "archived"

class Bookmark(BaseModel):
    """Entity model for Bookmark."""

    bookmark_id: str = Field(...)
    title: str = Field(...)
    url: str = Field(...)
    source: str | None = None
    saved_at: datetime = Field(...)
    read_status: BookmarkReadStatusEnum | None = None

class JournalEntryMoodEnum(str, Enum):
    GREAT = "great"
    GOOD = "good"
    NEUTRAL = "neutral"
    LOW = "low"
    DIFFICULT = "difficult"

class JournalEntry(BaseModel):
    """Entity model for JournalEntry."""

    entry_id: str = Field(...)
    date: date = Field(...)
    mood: JournalEntryMoodEnum | None = None
    summary: str | None = None
    word_count: int | None = None

