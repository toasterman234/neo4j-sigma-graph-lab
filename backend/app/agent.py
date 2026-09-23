"""Personal Knowledge AI Agent — PydanticAI implementation."""

from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass

from app.config import settings


# Ensure ANTHROPIC_API_KEY env var is set before PydanticAI creates the provider.
# pydantic-settings may load an empty value from the shell env, overriding .env.
if not os.environ.get("ANTHROPIC_API_KEY"):
    if settings.anthropic_api_key:
        os.environ["ANTHROPIC_API_KEY"] = settings.anthropic_api_key
    else:
        from dotenv import dotenv_values
        _key = dotenv_values("../.env").get("ANTHROPIC_API_KEY", "")
        if _key:
            os.environ["ANTHROPIC_API_KEY"] = _key

from pydantic_ai import Agent, RunContext

from app.context_graph_client import execute_cypher, get_schema
from app.memory import store_message, get_context, resolve_session_id


SYSTEM_PROMPT = """You are a personal knowledge management assistant with access to a rich knowledge
graph of notes, contacts, projects, topics, bookmarks, and journal entries.

Your capabilities include:
- Searching and connecting personal notes and bookmarks
- Managing contact relationships and tracking interactions
- Tracking project progress and identifying dependencies
- Discovering non-obvious connections across knowledge areas
- Surfacing relevant past reflections and insights from journal entries

Help the user build and navigate their personal knowledge graph. Surface
connections they might not see, remind them of relevant past notes, and
help them organize their thinking. Be conversational and insightful.


IMPORTANT: You MUST use the available tools to query the knowledge graph before answering any question about the data. Never guess or make up information — always use tools to look up actual data from the graph. If a user asks a question, identify which tool(s) can help answer it and call them.

CRITICAL: Call tools DIRECTLY without any introductory text. Do NOT say "I'll search for..." or "Let me look up..." before calling a tool — just call the tool immediately. Only generate text AFTER you have received the tool results and are ready to provide your final answer.

When writing Cypher queries with run_cypher:
- Never combine ORDER BY with DISTINCT or aggregation in the same RETURN clause — use a WITH clause first
- Always LIMIT results (default LIMIT 25) to avoid overwhelming responses
- Use toLower() for case-insensitive matching
- If a query fails, try a simpler approach rather than repeating the same pattern"""



@dataclass
class AgentDeps:
    """Dependencies injected into the agent."""
    session_id: str


agent = Agent(
    "openai:gpt-4o-mini",
    system_prompt=SYSTEM_PROMPT,
    deps_type=AgentDeps,
    retries=2,
)

# ---------------------------------------------------------------------------
# Agent tools — domain-specific for Personal Knowledge
# ---------------------------------------------------------------------------

@agent.tool
async def search_notes(ctx: RunContext[AgentDeps], query: str) -> str:
    """Search notes by title, content, or type"""
    cypher = """MATCH (n:Note)
    WHERE toLower(n.title) CONTAINS toLower($query)
       OR toLower(coalesce(n.content, '')) CONTAINS toLower($query)
    OPTIONAL MATCH (n)-[:TAGGED]->(t:Topic)
    OPTIONAL MATCH (n)-[:BELONGS_TO]->(p:Project)
    RETURN n, collect(DISTINCT t) AS topics, collect(DISTINCT p) AS projects
    ORDER BY n.updated_at DESC
    LIMIT 20
"""
    params = {
        "query": query,
    }
    result = await execute_cypher(cypher, params, tool_name="search_notes")
    return json.dumps(result, default=str)

@agent.tool
async def contact_lookup(ctx: RunContext[AgentDeps], query: str) -> str:
    """Search contacts by name, organization, or relationship type"""
    cypher = """MATCH (c:Contact)
    WHERE toLower(c.name) CONTAINS toLower($query)
       OR toLower(coalesce(c.organization, '')) CONTAINS toLower($query)
    OPTIONAL MATCH (c)-[:WORKED_ON]->(p:Project)
    OPTIONAL MATCH (c)-[:KNOWS]-(other:Contact)
    RETURN c, collect(DISTINCT p) AS projects, collect(DISTINCT other) AS connections
    LIMIT 20
"""
    params = {
        "query": query,
    }
    result = await execute_cypher(cypher, params, tool_name="contact_lookup")
    return json.dumps(result, default=str)

@agent.tool
async def project_status(ctx: RunContext[AgentDeps], query: str) -> str:
    """Get project status and related notes and contacts"""
    cypher = """MATCH (p:Project)
    WHERE toLower(p.name) CONTAINS toLower($query)
    OPTIONAL MATCH (n:Note)-[:BELONGS_TO]->(p)
    OPTIONAL MATCH (c:Contact)-[:WORKED_ON]->(p)
    RETURN p, collect(DISTINCT n) AS notes, collect(DISTINCT c) AS collaborators
    ORDER BY p.deadline ASC
    LIMIT 10
"""
    params = {
        "query": query,
    }
    result = await execute_cypher(cypher, params, tool_name="project_status")
    return json.dumps(result, default=str)

@agent.tool
async def topic_exploration(ctx: RunContext[AgentDeps], query: str) -> str:
    """Explore a topic and its connections across the knowledge graph"""
    cypher = """MATCH (t:Topic)
    WHERE toLower(t.name) CONTAINS toLower($query)
    OPTIONAL MATCH (n:Note)-[:TAGGED]->(t)
    OPTIONAL MATCH (b:Bookmark)-[:TAGGED]->(t)
    OPTIONAL MATCH (t)-[:RELATED_TO]-(related:Topic)
    RETURN t, collect(DISTINCT n) AS notes, collect(DISTINCT b) AS bookmarks,
           collect(DISTINCT related) AS related_topics
    LIMIT 10
"""
    params = {
        "query": query,
    }
    result = await execute_cypher(cypher, params, tool_name="topic_exploration")
    return json.dumps(result, default=str)

@agent.tool
async def knowledge_connections(ctx: RunContext[AgentDeps], query: str) -> str:
    """Find connections between different knowledge items"""
    cypher = """MATCH path = (a)-[*1..3]-(b)
    WHERE (a:Note OR a:Bookmark OR a:Topic) AND (b:Note OR b:Bookmark OR b:Topic)
      AND toLower(coalesce(a.title, a.name, '')) CONTAINS toLower($query)
      AND a <> b
    RETURN path
    LIMIT 30
"""
    params = {
        "query": query,
    }
    result = await execute_cypher(cypher, params, tool_name="knowledge_connections")
    return json.dumps(result, default=str)

@agent.tool
async def list_notes(ctx: RunContext[AgentDeps], limit: str) -> str:
    """List note records with optional limit"""
    cypher = """MATCH (n:Note)
    RETURN n
    ORDER BY n.title
    LIMIT toInteger($limit)
"""
    params = {
        "limit": limit,
    }
    result = await execute_cypher(cypher, params, tool_name="list_notes")
    return json.dumps(result, default=str)

@agent.tool
async def get_note_by_id(ctx: RunContext[AgentDeps], id: str) -> str:
    """Get a specific note by ID with all connections"""
    cypher = """MATCH (n:Note {note_id: $id})
    OPTIONAL MATCH (n)-[r]-(related)
    RETURN n, type(r) AS relationship, labels(related) AS related_labels, related.name AS related_name
    LIMIT 50
"""
    params = {
        "id": id,
    }
    result = await execute_cypher(cypher, params, tool_name="get_note_by_id")
    return json.dumps(result, default=str)



@agent.tool
async def run_cypher(ctx: RunContext[AgentDeps], query: str, parameters: str = "{}") -> str:
    """Execute a read-only Cypher query against the knowledge graph."""
    try:
        params = json.loads(parameters) if parameters else {}
    except json.JSONDecodeError:
        return json.dumps([{"error": "Invalid JSON parameters"}])
    params.setdefault("domain", settings.domain_id)
    try:
        result = await execute_cypher(query, params, tool_name="run_cypher")
        return json.dumps(result, default=str)
    except Exception as e:
        return json.dumps([{"error": f"Cypher query failed: {e}"}])


@agent.tool
async def get_graph_schema(ctx: RunContext[AgentDeps]) -> str:
    """Get the knowledge graph schema (node labels and relationship types)."""
    result = await get_schema()
    return json.dumps(result, default=str)


# ---------------------------------------------------------------------------
# Message handler
# ---------------------------------------------------------------------------


async def handle_message(message: str, session_id: str | None = None) -> dict:
    """Handle an incoming chat message."""
    session_id = resolve_session_id(session_id)

    # Store user message (triggers entity extraction + preference detection)
    await store_message(session_id, "user", message)

    # Get rich context (messages + entities + preferences + traces)
    context = await get_context(session_id, query=message)
    history = context.get("messages", [])

    # Convert history to PydanticAI message format
    from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart
    message_history = []
    for msg in history:
        if msg["role"] == "user":
            message_history.append(
                ModelRequest(parts=[UserPromptPart(content=msg["content"])])
            )
        elif msg["role"] == "assistant":
            message_history.append(
                ModelResponse(parts=[TextPart(content=msg["content"])])
            )

    deps = AgentDeps(session_id=session_id)
    result = await agent.run(
        message, deps=deps, message_history=message_history
    )

    response_text = result.output or ""
    if not response_text.strip():
        response_text = "I searched the knowledge graph but couldn't find relevant results for your query. Could you try rephrasing your question?"
    assistant_result = await store_message(session_id, "assistant", response_text)

    return {
        "response": response_text,
        "session_id": session_id,
        "graph_data": None,
        "entities_extracted": (assistant_result or {}).get("entities", []),
        "preferences_detected": (assistant_result or {}).get("preferences", []),
    }


async def handle_message_stream(message: str, session_id: str | None = None) -> dict:
    """Handle a chat message with streaming text deltas via the collector event queue."""
    from app.context_graph_client import get_collector

    session_id = resolve_session_id(session_id)

    collector = get_collector()
    await store_message(session_id, "user", message)

    # Get rich context (messages + entities + preferences + traces)
    context = await get_context(session_id, query=message)
    history = context.get("messages", [])

    # Convert history to PydanticAI message format
    from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart
    message_history = []
    for msg in history:
        if msg["role"] == "user":
            message_history.append(
                ModelRequest(parts=[UserPromptPart(content=msg["content"])])
            )
        elif msg["role"] == "assistant":
            message_history.append(
                ModelResponse(parts=[TextPart(content=msg["content"])])
            )

    deps = AgentDeps(session_id=session_id)
    # Use agent.run() (not run_stream) so the full agent loop completes —
    # including all tool calls — before we emit the final text.
    # run_stream stops at the first text part, so it cuts off before tool
    # results are incorporated when Claude generates "I'll search..." + a tool
    # call in the same response.  Tool events (tool_start / tool_end) are still
    # pushed to the SSE queue by execute_cypher during the run.
    result = await agent.run(
        message, deps=deps, message_history=message_history
    )

    response_text = result.output or ""
    if not response_text.strip():
        response_text = "I searched the knowledge graph but couldn't find relevant results for your query. Could you try rephrasing your question?"

    collector.emit_text_delta(response_text)
    assistant_result = await store_message(session_id, "assistant", response_text)
    if assistant_result:
        collector.emit_entities_extracted(assistant_result.get("entities", []))
        collector.emit_preferences_detected(assistant_result.get("preferences", []))
    collector.emit_done(response_text, session_id)

    return {
        "response": response_text,
        "session_id": session_id,
        "graph_data": None,
    }
