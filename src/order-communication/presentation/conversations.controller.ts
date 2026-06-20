import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommunicationService } from '../application/communication.service';
import { ConversationQueryDto } from '../application/communication.dto';
import { FirebaseAuthGuard } from '../../common/auth/firebase-auth.guard';

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
}
