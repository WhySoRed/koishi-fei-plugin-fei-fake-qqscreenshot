import { Context, Session, Schema, h } from "koishi";
import {} from "koishi-plugin-puppeteer";
import { RuDian } from "koishi-plugin-mememaker";
export const inject = {
  required: ["database", "puppeteer", "canvas"],
};

export const name = "fei-fake-qqscreenshot";

export interface Config {}

export const Config: Schema<Config> = Schema.object({});

export const usage = `
把消息按照qq截图的样子发送出去 ～<br>
和“mememaker插件”有联动 ～<br>
一起安装可以获得截图入典功能
`;

export function apply(ctx: Context) {
  const screenshotMessageHtmlTemp: {
    [ciduid: string]: {
      messageHtml: string;
      count: number;
      nearTimeStamp?: number;
    };
  } = {};
  ctx.command("截图").action(async ({ session }) => {
    const ciduid = session.cid + session.uid;
    if (!screenshotMessageHtmlTemp[ciduid]) {
      if (!session?.quote) return "请回复一条消息~";
      return await screenshotMaker(session);
    }
    const messageHtml = screenshotMessageHtmlTemp[ciduid].messageHtml;
    const screenshot = await screenshotMaker(session, messageHtml);
    delete screenshotMessageHtmlTemp[ciduid];
    return screenshot;
  });

  const ruDian = new RuDian(ctx, 12, 24);
  if (ruDian?.RDOne) {
    ctx
      .command("截图入典 [颁奖词] [翻译]")
      .action(async ({ session }, message, trans = "") => {
        const ciduid = session.cid + session.uid;
        if (screenshotMessageHtmlTemp[ciduid]) {
          if (!trans) return "多条消息截图入典请输入参数";
        } else if (!session?.quote) return "请回复一条消息~";
        const base64String = (
          await screenshotMaker(
            session,
            screenshotMessageHtmlTemp[ciduid]?.messageHtml
          )
        )
          .replace('<img src="', "")
          .replace('"/>', "");

        delete screenshotMessageHtmlTemp[ciduid];

        message = (
          await elementTrans(session, message || session.quote.content)
        )?.replace(/<img.*?\/>/g, "[图片]");
        if (
          (h.select(trans, "img").length === 1 &&
            h.select(trans, ":not(img)").length === 0) ||
          !trans
        )
          trans = await ruDian.translate(message, "ja");
        else
          trans = (await elementTrans(session, trans)).replace(
            /<img.*?\/>/g,
            "[图片]"
          );

        return ruDian.RDOne(base64String, message, trans);
      });
  }

  ctx.command("截图添加").action(async ({ session }) => {
    if (!session?.quote) return "请回复一条消息~";
    const ciduid = session.cid + session.uid;
    if (!screenshotMessageHtmlTemp[ciduid]) {
      screenshotMessageHtmlTemp[ciduid] = { messageHtml: "", count: 0 };
      ctx.setTimeout(() => {
        delete screenshotMessageHtmlTemp[ciduid];
      }, 60000 * 10);
    }
    screenshotMessageHtmlTemp[ciduid].count++;
    const timeDiff =
      session.quote.timestamp -
      screenshotMessageHtmlTemp[ciduid]?.nearTimeStamp;
    const timeString =
      timeDiff < 60000 && timeDiff > 0
        ? null
        : timeStamp2timeString(session.quote.timestamp);
    screenshotMessageHtmlTemp[ciduid].messageHtml += messageHtmlMaker(
      session.quote.user.avatar,
      session.quote.member?.nick || session.quote.user.name,
      await elementTrans(session, session.quote.content),
      timeString,
      (session.quote?.quote?.member?.nick || session.quote?.user?.name) +
        " " +
        timeStamp2timeString(session.quote?.quote?.timestamp),
      await elementTrans(session, session.quote?.quote?.content)
    );
    screenshotMessageHtmlTemp[ciduid].nearTimeStamp = session.quote.timestamp;
    return (
      "已添加" +
      screenshotMessageHtmlTemp[ciduid].count +
      "条消息，发送'截图'来截图"
    );
  });

  /**
   *
   * 此指令已经完成，但感觉可能会被滥用所以没有进行开放
   * 如果想要开启可以去掉 if (false)
   */

  if (false)
    ctx
      .command("截图自定义 <message:text>")
      .usage(
        `自定义截图，格式为` +
          `截图自定义` +
          `<群组名> ` +
          `<@用户> <消息内容>` +
          `<@用户> <消息内容> ` +
          `<@用户> <消息内容>` +
          `...`
      )
      .action(async ({ session }, message) => {
        if (session.event.channel.type) return "私聊无法使用";
        const getGuildMemberList = await session.bot.getGuildMemberList(
          session.guildId
        );
        const [guildName, ...messageArr] = message
          .replace(/<at/g, "\n<at")
          .split("\n");
        const messageHtmls = messageArr.reduce((pre, cur) => {
          if (!cur) return pre;
          if (!h.select(cur, "at")[0].attrs)
            throw new Error("请at一个存在于本群组的用户");
          const member = getGuildMemberList.data.find(
            (member) => member.user.id === h.select(cur, "at")[0].attrs.id
          );
          return (
            pre +
            messageHtmlMaker(
              member.user.avatar,
              member.nick || member.user.name,
              cur.replace(/<at.*?\/>/g, ""),
              null
            )
          );
        }, "");

        const timeString = timeStamp2timeString(Date.now());
        const fakeTimeHtml = `<div class="fake-time">${timeString}</div>`;
        const html = screenshotHtmlMaker(
          fakeTimeHtml + messageHtmls,
          guildName
        );

        const img = await ctx.puppeteer.render(html, async (page, next) => {
          const canvas = await page.$("#canvas");
          return await next(canvas);
        });

        return img;
      });

  async function elementTrans(session: Session, message: string) {
    if (h.select(message, "at").length === 0) return message;

    if (session.event.channel.type) return message;

    const getGuildMemberList = await session.bot.getGuildMemberList(
      session.guildId
    );
    message = h.transform(message, {
      at(attrs) {
        if (attrs.name) return "@" + attrs.name + "";
        const member = getGuildMemberList.data.find(
          (member) => member.user.id === attrs.id
        );
        return "@" + (member?.nick || member?.user?.name || attrs.id) + " ";
      },
    });

    return message;
  }

  async function screenshotMaker(session: Session, messageHtmls: string = "") {
    let messageHtml: string = "";
    if (session.quote) {
      const quoteNameTime =
        (session.quote?.quote?.member?.nick || session.quote?.user?.name) +
        " " +
        timeStamp2timeString(session.quote?.quote?.timestamp);
      const quoteMessage = await elementTrans(
        session,
        session.quote?.quote?.content
      );

      const timeString =
        session.quote.timestamp -
          screenshotMessageHtmlTemp[session.cid + session.uid]?.nearTimeStamp <
        60000
          ? null
          : timeStamp2timeString(session.quote.timestamp);
      messageHtml = messageHtmlMaker(
        session.quote.user.avatar,
        session.quote.member?.nick || session.quote.user.name,
        await elementTrans(session, session.quote.content),
        timeString,
        quoteNameTime,
        quoteMessage
      );
    }

    const html = screenshotHtmlMaker(
      messageHtmls + messageHtml,
      session.event.channel.type
        ? "私聊"
        : (await session.bot.getChannel(session.channelId)).name
    );

    const img = await ctx.puppeteer.render(html, async (page, next) => {
      const canvas = await page.$("#canvas");
      return await next(canvas);
    });

    return img;
  }

  function timeStamp2timeString(timestamp: number) {
    const messageTime = new Date(timestamp);

    if (messageTime.getDate() == new Date().getDate())
      return messageTime.toLocaleTimeString().slice(0, -3);
    const month = String(messageTime.getMonth() + 1).padStart(2, "0");
    const day = String(messageTime.getDate()).padStart(2, "0");
    if (messageTime.getFullYear() == new Date().getFullYear())
      return `${month}/${day} ${messageTime.toLocaleTimeString()}`.slice(0, -3);
    else
      return `${messageTime.getFullYear()}/${month}/${day} ${messageTime.toLocaleTimeString()}`.slice(
        0,
        -3
      );
  }

  function messageHtmlMaker(
    avatarUrl: string,
    name: string,
    message: string,
    timeString: string,
    quoteNameTime?: string,
    quoteMessage?: string
  ) {
    let messageBubble = "";

    if (
      h.select(message, "img").length === 1 &&
      h.select(message, ":not(img)").length === 0
    )
      messageBubble = message;
    else {
      if (quoteNameTime && quoteMessage)
        messageBubble += `<div class="quote">
        <p>${quoteNameTime}</p>
        <p>${quoteMessage}</p>
      </div>
      `;
      messageBubble += `<p>${message.replace(/\n/g, "<br>")}</p>`;

      messageBubble = `<div class="message">` + messageBubble + `</div>`;
    }

    let messageHtml = `
    <div class="message-box">
      <div class="avatar" style="background-image: url(${avatarUrl});"></div>
      <div class="message-frame">
        <div class="name">${name}</div>
          ${messageBubble}
      </div>
    </div>
    `;
    if (timeString !== null)
      messageHtml = `<div class="fake-time">${timeString}</div>` + messageHtml;

    return messageHtml;
  }

  function screenshotHtmlMaker(messageHtml: string, guildName: string) {
    return `
<div id="canvas" style="width: 1240; background-color: #EFEFEF;">
  <img src="data:image/png;base64,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" />
  <div class="fake-guildname">${guildName}</div>
  ${messageHtml}
  <img src="data:image/png;base64,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" />
</div>

<style>
  div {
    font-family: Arial;
  }

  .fake-time {
    text-align: center;
    color: #949294;
    padding: 40;
    font-size: 30px;
  }

  .fake-guildname {
    font-size: 50px;
    position: absolute;
    top: 50;
    left: 135;
  }

  .message-box {
    display: flex;
    margin: 10 30;
  }

  .message-box .avatar {
    position: relative;
    width: 125;
    height: 125;
    flex-shrink: 0;
    border-radius: 50%;
    background-size: contain;
  }

  .message-frame {
    display: flex;
    flex-direction: column;
    left: 125;
    margin-left: 20;
    margin-right: 210;
  }

  .message-box .name {
    font-size: 30;
    color: #949294;
  }

  .message-frame .message {
    margin: 30 auto 30 0;
    padding: 20;
    font-size: 50px;
    background-color: white;
    border-radius: 30px;
  }

  .message-frame .message > p {
    margin: 0;
    padding: 15;
  }

  .message-frame .message .quote {
    border-radius: 20px;
    background-color: #e7e7e7;
    padding: 10 20;
  }


  .message-frame .message .quote p {
    font-size: 35px;
    padding: 10 0;
    margin: 0;
  }

  .message-frame > img {
    margin: 30 auto 30 0;
    max-width: 100%;
    border-radius: 20px;
  }

  .message-frame .message img {
    max-width: 100%;
    border-radius: 20px;
  }
</style>
`;
  }
}
