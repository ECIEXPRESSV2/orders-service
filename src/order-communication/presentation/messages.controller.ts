import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunicationService } from '../application/communication.service';
import { MarkMessageReadDto, MessageQueryDto, SendMessageDto, TypingDto } from '../application/communication.dto';
import { FirebaseAuthGuard } from '../../common/auth/firebase-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth-user';

@ApiTags('Messages')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly communicationService: CommunicationService) {}

  @Get()
  @ApiOperation({ summary: 'List messages (conversationId required; caller must belong to it)' })
  findAll(@Query() query: MessageQueryDto, @CurrentUser() user: AuthUser) {
    return this.communicationService.getMessages(query, user.userId);
  }

  @Get('conversation/:conversationId')
  @ApiOperation({ summary: 'Get messages by conversation' })
  byConversation(@Param('conversationId') conversationId: string, @CurrentUser() user: AuthUser) {
    return this.communicationService.getConversationMessages(conversationId, user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Send message' })
  send(@Body() dto: SendMessageDto, @CurrentUser() user: AuthUser) {
    return this.communicationService.sendMessage({ ...dto, senderId: user.userId });
  }

  @Post('read')
  @ApiOperation({ summary: 'Mark message as read' })
  read(@Body() dto: MarkMessageReadDto, @CurrentUser() user: AuthUser) {
    return this.communicationService.markMessageAsRead({ ...dto, participantId: user.userId });
  }

  @Post('typing')
  @ApiOperation({ summary: 'Set typing state' })
  typing(@Body() dto: TypingDto, @CurrentUser() user: AuthUser) {
    return this.communicationService.setTyping({ ...dto, userId: user.userId });
  }
}
