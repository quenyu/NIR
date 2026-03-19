from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Block(BaseModel):
    id: str
    type: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    input_ports: list[str] = Field(default_factory=list)
    output_ports: list[str] = Field(default_factory=list)


class Connection(BaseModel):
    from_block: str
    from_port: str
    to_block: str
    to_port: str


class Diagram(BaseModel):
    blocks: list[Block] = Field(default_factory=list)
    connections: list[Connection] = Field(default_factory=list)

