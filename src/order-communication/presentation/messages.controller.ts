import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunicationService } from '../application/communication.service';
import { MarkMessageReadDto, MessageQueryDto, SendMessageDto, TypingDto } from '../application/communication.dto';

@ApiTags('Messages')
@Controller('messages')
export class MessagesController {
  constructor(private readonly communicationService: CommunicationService) {}

  @Get()
  @ApiOperation({ summary: 'List messages' })
  findAll(@Query() query: MessageQueryDto) {
    return this.communicationService.getMessages(query);
  }

  @Get('conversation/:conversationId')
  @ApiOperation({ summary: 'Get messages by conversation' })
  byConversation(@Param('conversationId') conversationId: string) {
    return this.communicationService.getConversationMessages(conversationId);
  }

  @Post()
  @ApiOperation({ summary: 'Send message' })
  send(@Body() dto: SendMessageDto) {
    return this.communicationService.sendMessage(dto);
  }

  @Post('read')
  @ApiOperation({ summary: 'Mark message as read' })
  read(@Body() dto: MarkMessageReadDto) {
    return this.communicationService.markMessageAsRead(dto);
  }

  @Post('typing')
  @ApiOperation({ summary: 'Set typing state' })
  typing(@Body() dto: TypingDto) {
    return this.communicationService.setTyping(dto);
  }
}