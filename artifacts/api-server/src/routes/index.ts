import { Router, type IRouter } from "express";
import assistantRouter from "./assistant";
import healthRouter from "./health";
import githubDeveloperRouter from "./githubDeveloper";
import githubDeveloperControlsRouter from "./githubDeveloperControls";

const router: IRouter = Router();

router.use(healthRouter);
router.use(assistantRouter);
router.use("/github", githubDeveloperRouter);
router.use("/github/controls", githubDeveloperControlsRouter);

export default router;
