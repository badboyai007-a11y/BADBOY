import { Router, type IRouter } from "express";
import assistantRouter from "./assistant";
import healthRouter from "./health";
import githubDeveloperRouter from "./githubDeveloper";

const router: IRouter = Router();

router.use(healthRouter);
router.use(assistantRouter);
router.use("/github", githubDeveloperRouter);

export default router;
