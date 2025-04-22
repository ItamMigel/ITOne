from sqlalchemy import Column, Integer, String, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.types import DateTime

from services.auth_service.app.database import Base


class Chat(Base):
    __tablename__ = "chats"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String, nullable=False, default="Новый чат")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationship with User model
    user = relationship("User", back_populates="chats")
    # Relationship with ChatHistory model
    messages = relationship("ChatHistory", back_populates="chat", cascade="all, delete-orphan")


class ChatHistory(Base):
    __tablename__ = "chat_history"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    chat_id = Column(Integer, ForeignKey("chats.id"))
    message = Column(Text)
    response = Column(Text)
    image = Column(Text, nullable=True)  # For storing base64 encoded BPMN diagram images
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationship with User model
    user = relationship("User", back_populates="chat_history")
    # Relationship with Chat model
    chat = relationship("Chat", back_populates="messages") 