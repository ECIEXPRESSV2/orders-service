import { Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunicationService } from '../application/communication.service';
import { ConversationQueryDto } from '../application/communication.dto';
import { FirebaseAuthGuard } from '../../common/auth/firebase-auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth-user';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(FirebaseAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly communicationService: CommunicationService) {}

  @Get()
  @ApiOperation({ summary: 'List conversations' })
  findAll(@Query() query: ConversationQueryDto) {
    return this.communicationService.getConversations(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation by id' })
  findOne(@Param('id') id: string) {
    return this.communicationService.getConversationById(id);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark all messages in a conversation as read' })
  read(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.communicationService.markConversationRead(id, user.userId);
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archive a conversation' })
  archive(@Param('id') id: string) {
    return this.communicationService.setConversationStatus(id, 'archived');
  }

  @Patch(':id/unarchive')
  @ApiOperation({ summary: 'Restore an archived conversation' })
  unarchive(@Param('id') id: string) {
    return this.communicationService.setConversationStatus(id, 'active');
  }
}
