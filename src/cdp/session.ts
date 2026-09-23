import { cdpHttp } from "./http";
import { CdpClient } from "./client";
import { UnaError } from "../errors";

export interface TabInfo {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

export class PageSession {
  readonly client: CdpClient;
  readonly targetId: string;

  private constructor(client: CdpClient, targetId: string) {
    this.client = client;
    this.targetId = targetId;
  }

  static async connect(port: number, targetId?: string): Promise<PageSession> {
    const tabs = await cdpHttp<TabInfo[]>(port, "/json/list");
    let tab = targetId ? tabs.find((t) => t.id === targetId) : tabs.find((t) => t.type === "page");
    tab = tab ?? tabs[0];
    if (!tab) throw new UnaError("not_found", "no page target", "launch a browser first");
    const client = await CdpClient.connect(tab.webSocketDebuggerUrl);
    const session = new PageSession(client, tab.id);
    try {
      await client.send("DOM.enable");
      await client.send("Page.enable");
      await client.send("Runtime.enable");
    } catch (err) {
      client.close();
      throw err;
    }
    return session;
  }

  async navigate(url: string): Promise<void> {
    await this.client.send("Page.navigate", { url });
    await this.client.send("Page.enable"); // re-enable after navigation keeps events flowing
  }

  async close(): Promise<void> {
    this.client.close();
  }
}