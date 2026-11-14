import { Router, type IRouter } from "express";
import healthRouter from "./health";
import askLocalRouter from "./ask-local";

const router: IRouter = Router();

router.use(healthRouter);
router.use(askLocalRouter);

export default router;
